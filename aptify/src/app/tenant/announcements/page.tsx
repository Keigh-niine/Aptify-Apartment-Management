import { redirect } from "next/navigation";

// Announcements and notifications now live together in Mail
export default function Page() {
  redirect("/tenant/mail");
}