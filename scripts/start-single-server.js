// This mainland single-server profile intentionally cannot make paid AI calls.
if(process.env.NODE_ENV!=='production')throw new Error('Single-server profile requires NODE_ENV=production');
if(process.env.AI_ENABLED!=='false')throw new Error('Single-server profile requires AI_ENABLED=false; real AI is not authorized for this profile');
await import('./dev-server.js');
