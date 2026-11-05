/* Same-origin API requests only. Authentication is never retried or navigated automatically. */
(() => {
  async function fetchAPI(path,options={}) {
    const url=new URL(path,document.baseURI);
    if(url.origin!==location.origin||!['http:','https:'].includes(url.protocol))throw Error('API 地址必须与当前网页同源。');
    let response;
    try {
      response=await window.fetch(url.href,{...options,credentials:'same-origin',mode:'same-origin',redirect:'error',signal:options.signal||AbortSignal.timeout(10000)});
    } catch {
      throw Error('API 请求未完成，可能是网络错误或认证跳转被阻止。请在当前站点完成认证后手动重试。');
    }
    if(response.redirected||response.type==='opaqueredirect')throw Error('API 返回了跳转，已停止；请手动完成当前站点认证。');
    if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('API 未返回 JSON，可能是认证页面或代理错误；已停止请求，不会自动跳转或重试。');
    return response;
  }
  window.PersonaVerseHTTP=Object.freeze({fetch:fetchAPI});
})();
