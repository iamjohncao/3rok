import type { Metadata } from "next";
import { AccountScreen } from "../../components/AccountScreen";

export const metadata: Metadata = { title: "Account" };

type AccountPageProps = { searchParams: Promise<{ problem?: string }> };

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const { problem } = await searchParams;

  return (
    <main className="app-main account-main">
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">One person, many cases</p>
          <h1 className="page-head__title heading-lg">Account</h1>
        </div>
      </header>
      <AccountScreen problem={problem ?? null} />
    </main>
  );
}
