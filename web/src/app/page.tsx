import { redirect } from "next/navigation";
import { LATEST_SEASON } from "@/lib/seasons";

export default function Home() {
  redirect(`/season/${LATEST_SEASON}/overview`);
}
