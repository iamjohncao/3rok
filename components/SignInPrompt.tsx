import Link from "next/link";

// Shown in place of a case screen when nobody is signed in.
export function SignInPrompt({ what }: { what: string }) {
  return (
    <section className="frame frame--empty" aria-label="Sign in needed">
      <div>
        <p className="body rok-muted">{what}</p>
        <Link className="rok-btn button" href="/account">
          Sign in
        </Link>
      </div>
    </section>
  );
}
