import { describe, expect, it, vi } from "vitest";

import { listPrintifyProducts, PrintifyValidationError, validatePrintifyApiKey } from "./printify.server";

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

  it("lists Printify products across pages and normalizes variant costs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          current_page: 1,
          last_page: 2,
          data: [
            {
              id: "prod_1",
              title: "Fixture Tee",
              blueprint_id: 12,
              print_provider_id: 44,
              updated_at: "2026-04-10T14:00:00Z",
              variants: [
                {
                  id: 9001,
                  title: "Black / M",
                  sku: "SKU-TEE-M",
                  cost: 1299,
                },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          current_page: 2,
          last_page: 2,
          data: [
            {
              id: "prod_2",
              title: "Fixture Hoodie",
              blueprint_id: 18,
              print_provider_id: 77,
              update_at: "2026-04-10T15:00:00Z",
              variants: [
                {
                  id: 9002,
                  title: "Heather / L",
                  sku: "SKU-HOODIE-L",
                  cost: 2199,
                },
              ],
            },
          ],
        }),
      });

    const result = await listPrintifyProducts("pk_live_fixture", "1234", fetchMock as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        productId: "prod_1",
        productTitle: "Fixture Tee",
        productUpdatedAt: new Date("2026-04-10T14:00:00Z"),
        blueprintId: "12",
        printProviderId: "44",
        variantId: "9001",
        variantTitle: "Black / M",
        sku: "SKU-TEE-M",
        cost: 1299,
      },
      {
        productId: "prod_2",
        productTitle: "Fixture Hoodie",
        productUpdatedAt: new Date("2026-04-10T15:00:00Z"),
        blueprintId: "18",
        printProviderId: "77",
        variantId: "9002",
        variantTitle: "Heather / L",
        sku: "SKU-HOODIE-L",
        cost: 2199,
      },
    ]);
  });
});
