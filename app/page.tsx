import { redirect } from "next/navigation";

// The home screen is the case list. There is no marketing hero.
export default function Home() {
  redirect("/cases");
}
