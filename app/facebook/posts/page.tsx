import { FacebookQueuePage, type FacebookPageProps } from "../FacebookQueuePage";
export const dynamic = "force-dynamic";
export default function Page(props: FacebookPageProps) { return <FacebookQueuePage {...props} publishedOnly />; }
