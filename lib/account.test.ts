import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, accountStateFor, checkCredentials, describeAuthError } from "./account";

describe("checkCredentials", () => {
  it("accepts a normal email and a long enough password", () => {
    expect(checkCredentials("name@example.com", "correct horse")).toBeNull();
    expect(checkCredentials("  name@example.com  ", "12345678")).toBeNull();
  });

  it("asks for a full email address", () => {
    for (const bad of ["", "name", "name@", "@example.com", "name@example", "na me@example.com"]) {
      expect(checkCredentials(bad, "12345678"), bad).toContain("full email address");
    }
  });

  it("asks for a long enough password", () => {
    expect(checkCredentials("name@example.com", "1234567")).toContain(`${MIN_PASSWORD_LENGTH} characters`);
    expect(checkCredentials("name@example.com", "")).toContain(`${MIN_PASSWORD_LENGTH} characters`);
  });
});

describe("describeAuthError", () => {
  it("says a wrong email or password in one plain sentence that does not say which", () => {
    const sentence = describeAuthError({ message: "Invalid login credentials", code: "invalid_credentials" });
    expect(sentence).toBe("That email and password do not match an account.");
  });

  it("says when the email is not confirmed", () => {
    expect(describeAuthError({ message: "Email not confirmed", code: "email_not_confirmed" })).toContain("not confirmed");
  });

  it("says when there have been too many attempts", () => {
    expect(describeAuthError({ message: "x", code: "over_request_rate_limit" })).toContain("Too many attempts");
    expect(describeAuthError({ message: "x", status: 429 })).toContain("Too many attempts");
  });

  it("explains a weak password and turned-off sign-ups", () => {
    expect(describeAuthError({ message: "x", code: "weak_password" })).toContain("too weak");
    expect(describeAuthError({ message: "x", code: "signup_disabled" })).toContain("turned off");
  });

  it("passes any other message through", () => {
    expect(describeAuthError({ message: "Something unexpected." })).toBe("Something unexpected.");
  });
});

describe("accountStateFor", () => {
  it("is signed out with no user", () => {
    expect(accountStateFor(null)).toEqual({ status: "signed-out" });
  });

  it("is signed in with the user's id and email", () => {
    const user = { id: "u1", email: "name@example.com" } as User;
    expect(accountStateFor(user)).toEqual({ status: "signed-in", userId: "u1", email: "name@example.com" });
  });

  it("copes with a user that has no email", () => {
    expect(accountStateFor({ id: "u2" } as User)).toEqual({ status: "signed-in", userId: "u2", email: null });
  });
});
