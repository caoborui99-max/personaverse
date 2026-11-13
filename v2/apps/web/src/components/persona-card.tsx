import Link from 'next/link';
import type { Persona } from '@pv/shared';
import { FavoriteButton } from './storage-ui';
export function PersonaCard({ persona, index = 0 }: { persona: Persona; index?: number }) {
  return (
    <article className="persona-card">
      <div className={'avatar-art art-' + index}>
        <span className="orbit" />
        {persona.avatarUrl ? (
          <img className="persona-image" src={persona.avatarUrl} alt={persona.name} />
        ) : (
          <span className="orb" />
        )}
        <span className="art-label">
          {persona.mock ? 'TEST' : 'PERSONA'} / 00{index + 1}
        </span>
        <span className="mock-label">{persona.mock ? '中性测试资料' : '已发布'}</span>
      </div>
      <div className="card-content">
        <div className="card-heading">
          <span className="tag">{persona.category}</span>
          <FavoriteButton slug={persona.slug} />
        </div>
        <Link href={'/persona/' + persona.slug}>
          <h3>{persona.name}</h3>
        </Link>
        <p>{persona.summary}</p>
        <div className="card-actions">
          <Link className="button" href={'/chat/' + persona.slug}>
            开始聊天 <span>↗</span>
          </Link>
          <Link className="text-link" href={'/persona/' + persona.slug}>
            查看档案
          </Link>
        </div>
      </div>
    </article>
  );
}
