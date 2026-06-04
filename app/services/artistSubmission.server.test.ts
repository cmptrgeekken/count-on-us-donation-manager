import { describe, expect, it } from "vitest";

import {
  ArtistSubmissionSpamError,
  ArtistSubmissionValidationError,
  hashSubmissionIp,
  validateArtistSubmissionInput,
} from "./artistSubmission.server";

describe("validateArtistSubmissionInput", () => {
  it("normalizes a valid artist submission", () => {
    const result = validateArtistSubmissionInput({
      publicCreditName: "  Ada Studio  ",
      email: "ADA@EXAMPLE.COM ",
      publicLinks: "example.com\nhttps://instagram.com/ada",
      causeLinks: ["mutual-aid.example/donate"],
      causePreference: "Sparkly Rocketship can choose aligned causes",
      preferredContactMethod: "Instagram DM",
      contactDetail: "@ada",
      localConnection: "Twin Cities",
      artworkIdea: "A sticker design for mutual aid.",
      interestedFormats: ["Buttons", "Not a real format", "Full-color stickers"],
      artistSharePreference: "Receive artist payment",
      proofApprovalPreference: "Yes, I want to approve proofs before launch",
      termsAcknowledged: true,
      paymentAcknowledged: true,
    });

    expect(result.name).toBe("Ada Studio");
    expect(result.email).toBe("ada@example.com");
    expect(result.artistName).toBe("Ada Studio");
    expect(result.publicLinks).toEqual(["https://example.com/", "https://instagram.com/ada"]);
    expect(result.causeLinks).toEqual(["https://mutual-aid.example/donate"]);
    expect(result.causePreference).toBe("Sparkly Rocketship can choose aligned causes");
    expect(result.preferredContactMethod).toBe("Instagram DM");
    expect(result.contactDetail).toBe("@ada");
    expect(result.interestedFormats).toEqual(["Buttons", "Full-color stickers"]);
    expect(result.artistSharePreference).toBe("Receive artist payment");
    expect(result.paymentAcknowledged).toBe(true);
  });

  it("requires public credit name, email, preferred contact method, idea, and terms acknowledgement", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "",
        email: "not-an-email",
        artworkIdea: "",
        termsAcknowledged: false,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("requires contact detail for non-email preferred contact methods", () => {
    expect(() =>
      validateArtistSubmissionInput({
        publicCreditName: "Ada Studio",
        email: "ada@example.com",
        preferredContactMethod: "Instagram DM",
        artworkIdea: "A sticker design for mutual aid.",
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects non-public or unsafe portfolio links", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "Ada Artist",
        email: "ada@example.com",
        artworkIdea: "A sticker design for mutual aid.",
        publicLinks: ["javascript:alert(1)", "http://localhost:3000", "https://user:pass@example.com"],
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects non-public or unsafe cause links", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "Ada Artist",
        email: "ada@example.com",
        artworkIdea: "A sticker design for mutual aid.",
        causeLinks: ["file:///tmp/cause", "http://192.168.1.20/donate"],
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects email addresses without a public domain", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "Ada Artist",
        email: "ada@localhost",
        artworkIdea: "A sticker design for mutual aid.",
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects unsupported preferred contact methods", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "Ada Artist",
        email: "ada@example.com",
        artworkIdea: "A sticker design for mutual aid.",
        preferredContactMethod: "Unsupported channel",
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects unsupported cause preferences", () => {
    expect(() =>
      validateArtistSubmissionInput({
        name: "Ada Artist",
        email: "ada@example.com",
        artworkIdea: "A sticker design for mutual aid.",
        causePreference: "Choose anything at random",
        termsAcknowledged: true,
      }),
    ).toThrow(ArtistSubmissionValidationError);
  });

  it("rejects honeypot submissions", () => {
    expect(() =>
      validateArtistSubmissionInput({
        publicCreditName: "Ada Artist",
        email: "ada@example.com",
        preferredContactMethod: "Email",
        artworkIdea: "A sticker design for mutual aid.",
        termsAcknowledged: true,
        honeypot: "bot-filled-field",
      }),
    ).toThrow(ArtistSubmissionSpamError);
  });
});

describe("hashSubmissionIp", () => {
  it("hashes IP addresses without storing the raw value", () => {
    const hash = hashSubmissionIp("203.0.113.10");

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("203.0.113.10");
  });
});
