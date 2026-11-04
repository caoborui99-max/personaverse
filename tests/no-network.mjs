// Loaded before every unit test. A forgotten Provider mock fails before any network request.
globalThis.fetch = async () => { throw new Error('Network disabled in offline tests; inject a local fixture.'); };
