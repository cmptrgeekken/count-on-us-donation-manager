import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptProviderCredential, encryptProviderCredential } from "./providerCredentials.server";

describe("providerCredentials.server", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips encrypted provider credentials", () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_SECRET", "provider-test-secret");

    const encrypted = encryptProviderCredential("pk_live_fixture_printify_key");

    expect(encrypted).not.toContain("pk_live_fixture_printify_key");
    expect(decryptProviderCredential(encrypted)).toBe("pk_live_fixture_printify_key");
  });

  it("uses randomized IVs for repeated encryption", () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_SECRET", "provider-test-secret");

    const first = encryptProviderCredential("same-value");
    const second = encryptProviderCredential("same-value");

    expect(first).not.toBe(second);
  });
});
