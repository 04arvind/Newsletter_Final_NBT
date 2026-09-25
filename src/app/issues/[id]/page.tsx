import { getIssuesCollection, toObjectId } from "../../../lib/db/client";
import { notFound } from "next/navigation";

interface PageProps {
    // Next.js 16: `params` is a Promise and must be awaited.
    params : Promise<{ id : string}>
}

export default async function IssuePage({params}:PageProps){
    const { id } = await params;
    const objectId = toObjectId(id);
    if(!objectId){
        notFound();
    }
    const issues = await getIssuesCollection();
    const issue = await issues.findOne({_id:objectId});
    if(!issue){
        notFound();
    }
    return (
        <main className = "issue-view">
            <p className="issue-meta">
                Sent on {new Date(issue.sentAt).toLocaleDateString()}
            </p>
            <div className="issue-content"
            dangerouslySetInnerHTML={{ __html: issue.htmlContent}}
            />
        </main>
    )
}
