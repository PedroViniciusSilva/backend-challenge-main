import { describe, expect, it } from "bun:test";
import {
  calculatePayloadHash,
  canonicalJsonStringify,
} from "../../src/application/utils/CanonicalJson";

describe("Utility: CanonicalJson", () => {
  it("deve gerar o mesmo JSON e hash independente da ordem das propriedades", () => {
    const objA = { b: 2, a: 1, details: { z: 10, y: 20 } };
    const objB = { a: 1, b: 2, details: { y: 20, z: 10 } };

    expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
    expect(calculatePayloadHash(objA)).toBe(calculatePayloadHash(objB));
  });

  it("deve gerar hashes distintos para payloads com valores diferentes", () => {
    const objA = { amount: "10.00", currency: "BRL" };
    const objB = { amount: "10.01", currency: "BRL" };

    expect(calculatePayloadHash(objA)).not.toBe(calculatePayloadHash(objB));
  });
});
