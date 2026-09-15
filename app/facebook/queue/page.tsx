import { FacebookQueuePage, type FacebookPageProps } from "../FacebookQueuePage";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export default function Page(props: FacebookPageProps) { return <FacebookQueuePage {...props} />; }
