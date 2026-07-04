import { redirect } from "next/navigation";

// The proxy routes `/` to /dashboard (signed in) or /login (signed out);
// this is the fallback if the proxy is ever bypassed.
export default function Home() {
  redirect("/dashboard");
}
