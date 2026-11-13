BEGIN;

-- Historical migrations stay unchanged. Reject inconsistent legacy data instead of rewriting it.
ALTER TABLE "Persona" ADD CONSTRAINT "published_pointer_pair"
 CHECK (("publishedVersionId" IS NULL) = ("publishedSlug" IS NULL));
ALTER TABLE "Persona" ADD CONSTRAINT "published_slug_required"
 CHECK ("status" <> 'published' OR ("publishedVersionId" IS NOT NULL AND "publishedSlug" IS NOT NULL));
ALTER TABLE "Persona" ADD CONSTRAINT "published_slug_format"
 CHECK ("publishedSlug" IS NULL OR "publishedSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE FUNCTION pv_reject_chat_rebinding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."personaId", NEW."coreVersionId", NEW."adminId", NEW."visitorId")
    IS DISTINCT FROM ROW(OLD."personaId", OLD."coreVersionId", OLD."adminId", OLD."visitorId") THEN
  RAISE EXCEPTION 'Chat identity and ownership are immutable' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "immutable_chat_binding" BEFORE UPDATE ON "ChatSession"
 FOR EACH ROW EXECUTE FUNCTION pv_reject_chat_rebinding();

CREATE FUNCTION pv_publication_snapshot_valid(persona_id uuid, version_id uuid, published_slug text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT
  jsonb_typeof(v."profileSnapshot"->'slug') = 'string'
  AND v."profileSnapshot"->>'slug' = published_slug
  AND length(btrim(v."coreText", E' \n\r\t')) > 0
  AND length(btrim(v."openingMessage", E' \n\r\t')) > 0
  AND jsonb_typeof(v."profileSnapshot"->'name') = 'string'
  AND length(btrim(v."profileSnapshot"->>'name', E' \n\r\t')) > 0
  AND jsonb_typeof(v."profileSnapshot"->'summary') = 'string'
  AND length(btrim(v."profileSnapshot"->>'summary', E' \n\r\t')) > 0
  AND jsonb_typeof(v."profileSnapshot"->'background') = 'string'
  AND length(btrim(v."profileSnapshot"->>'background', E' \n\r\t')) > 0
  AND jsonb_typeof(v."profileSnapshot"->'avatarUrl') = 'string'
  AND CASE WHEN jsonb_typeof(v."profileSnapshot"->'tags') = 'array'
      THEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v."profileSnapshot"->'tags') tag
           WHERE jsonb_typeof(tag) <> 'string') ELSE false END
  AND CASE WHEN jsonb_typeof(v."profileSnapshot"->'categoryIds') = 'array'
      THEN jsonb_array_length(v."profileSnapshot"->'categoryIds') > 0
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v."profileSnapshot"->'categoryIds') category
           WHERE jsonb_typeof(category) <> 'string'
             OR (category #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      ELSE false END
 FROM "PersonaCoreVersion" v WHERE v.id = version_id AND v."personaId" = persona_id), false);
$$;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM "Persona" p WHERE p.status = 'published'
  AND NOT pv_publication_snapshot_valid(p.id, p."publishedVersionId", p."publishedSlug")) THEN
  RAISE EXCEPTION 'Legacy published snapshot needs owner review; no author content was modified';
 END IF;
END;
$$;

-- A transaction-local intent guard prevents accidental generic ORM writes. It is NOT admin authentication:
-- a holder of the trusted DB write credential can set this value. API auth + CSRF remain mandatory.
CREATE FUNCTION pv_guard_publication_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean; expected_action text;
BEGIN
 IF TG_OP = 'INSERT' THEN
  changed := NEW.status <> 'draft' OR NEW."publishedVersionId" IS NOT NULL OR NEW."publishedSlug" IS NOT NULL;
 ELSE
  changed := ROW(NEW.status, NEW."publishedVersionId", NEW."publishedSlug")
     IS DISTINCT FROM ROW(OLD.status, OLD."publishedVersionId", OLD."publishedSlug");
  IF NEW.status <> 'published'
     AND ROW(NEW."publishedVersionId", NEW."publishedSlug") IS DISTINCT FROM ROW(OLD."publishedVersionId", OLD."publishedSlug")
     AND (NEW."publishedVersionId" IS NOT NULL OR NEW."publishedSlug" IS NOT NULL) THEN
   RAISE EXCEPTION 'Cannot replace a publication pointer outside publication' USING ERRCODE = '23514';
  END IF;
 END IF;
 IF changed THEN
  expected_action := CASE NEW.status WHEN 'published' THEN 'publish' WHEN 'draft' THEN 'unpublish' WHEN 'archived' THEN 'archive' END;
  IF current_setting('personaverse.publication_action', true) IS DISTINCT FROM expected_action THEN
   RAISE EXCEPTION 'Publication changes require an explicit transaction intent' USING ERRCODE = '42501';
  END IF;
 END IF;
 IF NEW.status = 'published' AND NOT pv_publication_snapshot_valid(NEW.id, NEW."publishedVersionId", NEW."publishedSlug") THEN
  RAISE EXCEPTION 'Published slug and snapshot are inconsistent' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_persona_publication" BEFORE INSERT OR UPDATE ON "Persona"
 FOR EACH ROW EXECUTE FUNCTION pv_guard_publication_change();

COMMIT;
