import { redirect } from "next/navigation";
import { HOME_BY_ROLE, getUser } from "@/lib/server/auth";

export default async function Home() {
  const user = await getUser();
  redirect(user ? HOME_BY_ROLE[user.role] : "/login");
}
