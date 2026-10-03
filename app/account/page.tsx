import type { Metadata } from "next";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Panel } from "../../components/ui/Panel";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <main className="app-main account-main">
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">One person, many cases</p>
          <h1 className="page-head__title heading-lg">Account</h1>
        </div>
      </header>

      <Panel id="sign-in" title="Sign in">
        <form className="account-form">
          <Field label="Email" name="email" type="email" autoComplete="email" disabled />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            disabled
          />
          <div className="account-form__actions">
            <Button variant="solid" type="submit" disabled>
              Sign in
            </Button>
            <Button variant="quiet" disabled>
              Create account
            </Button>
          </div>
        </form>
      </Panel>
    </main>
  );
}
