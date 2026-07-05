import { redirect } from "next/navigation";

// `/` → /dashboard, which (via the (app) layout's requireSession) sends
// signed-out visitors on to /login.
export default function Home() {
  redirect("/dashboard");
}
