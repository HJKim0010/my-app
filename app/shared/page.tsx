import type { Metadata } from "next";
import SharedConversation from "./SharedConversation";

export const metadata: Metadata = {
  title: "공유된 대화 | My Writing Assistant",
  robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer",
};
export default function SharedPage() { return <SharedConversation />; }
