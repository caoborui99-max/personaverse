export function CatalogUnavailable({ href = '/' }: { href?: string }) {
  return (
    <div className="empty" role="alert">
      <h2>人格列表暂时无法加载</h2>
      <p>服务暂时不可用，请稍后重试。你的账号和已有记录不会因此改变。</p>
      <a className="button" href={href}>
        重新加载
      </a>
    </div>
  );
}
