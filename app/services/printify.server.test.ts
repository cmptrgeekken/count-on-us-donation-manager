import { describe, expect, it, vi } from "vitest";

import { PrintifyValidationError, validatePrintifyApiKey } from "./printify.server";

describe("printify.server", () => {
  it("validates an API key and returns the primary accessible shop", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { id: 101, title: "Main Shop" },
          { id: 202, title: "Second Shop" },
        ],
      }),
    });

    const result = await validatePrintifyApiKey("pk_live_fixture", fetchMock as never);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.shopCount).toBe(2);
    expect(result.primaryShop).toEqual({
      id: "101",
      title: "Main Shop",
    });
  });

  it("raises a validation error for unauthorized credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        message: "Unauthorized",
      }),
    });

    await expect(validatePrintifyApiKey("bad-key", fetchMock as never)).rejects.toMatchObject({
      name: "PrintifyValidationError",
      message: "Unauthorized",
      status: 422,
    } satisfies Partial<PrintifyValidationError>);
  });
});
