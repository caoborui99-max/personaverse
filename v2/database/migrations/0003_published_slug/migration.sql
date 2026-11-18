ALTER TABLE "Persona" ADD COLUMN "publishedSlug" VARCHAR(80);
CREATE UNIQUE INDEX "Persona_publishedSlug_key" ON "Persona"("publishedSlug");
