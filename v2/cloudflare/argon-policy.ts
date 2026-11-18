// Shared policy only: importing this file must never pull WASM into the API Worker.
export const Algorithm = { Argon2id: 2 };
export const PARAMETERS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export function validPhc(value: string) {
  return (
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22,86}\$[A-Za-z0-9+/]{43}$/.test(value) &&
    value.length < 256
  );
}
