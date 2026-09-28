import { NextRequest, NextResponse } from "next/server";
import { getSubscribersCollection, getIssuesCollection } from '../../../../lib/db/client'
import { composeNewsletter } from "../../../../lib/email/compose";
import { sendEmail } from "../../../../lib/email/send";
import { getInternalAppBaseUrl } from "../../../../lib/internal-base-url";
import { createUnsubscribeToken } from "../../../../lib/unsubscribe-token";

function isAuthorized(req: NextRequest) {
  return req.headers.get('x-cron-secret') === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const baseUrl = getInternalAppBaseUrl(req);

    // 1. Merged/ranked trends from your existing pipeline
    const trendsRes = await fetch(`${baseUrl}/api/trends/merge`)
    const trends = await trendsRes.json()

    // 2. Featured podcast pick
    const podcastRes = await fetch(`${baseUrl}/api/newsletter/podcast`)
    const podcastPick = await podcastRes.json()

    // 3. LLM filter/curation
    const filteredRes = await fetch(`${baseUrl}/api/llm/filter`, {
      method: 'POST',
      body: JSON.stringify({ trends }),
    })
    const curatedItems = await filteredRes.json()

    if (!curatedItems?.length) {
      return NextResponse.json({ message: 'Nothing to send today' })
    }

    // 4. Compose the HTML issue
    const html = composeNewsletter({ items: curatedItems, featuredPodcast: podcastPick })

    // 5. Active subscribers only
    const subscribersCollection = await getSubscribersCollection()
    const subscribers = await subscribersCollection
      .find({ status: 'active', unsubscribed: { $ne: true } }, { projection: { email: 1 } })
      .toArray()

    if (!subscribers.length) {
      return NextResponse.json({ message: 'No active subscribers' })
    }

    // 6. Log the issue before sending — keeps a record even if send partially fails
    const issuesCollection = await getIssuesCollection()
    const { insertedId: issueId } = await issuesCollection.insertOne({
      htmlContent: html,
      topTrend: curatedItems[0]?.title ?? null,
      sentCount: 0,
      sentAt: new Date(),
    })

    // 7. Send in batches
    // const batchSize = 50
    // let sentCount = 0

    // for (let i = 0; i < subscribers.length; i += batchSize) {
    //   const batch = subscribers.slice(i, i + batchSize)
    //   await Promise.all(
    //     batch.map((sub) =>
    //       sendEmail({
    //         to: sub.email,
    //         subject: `NBT Newsletter — ${new Date().toLocaleDateString()}`,
    //         html: html.replace('{{unsubscribe_email}}', encodeURIComponent(sub.email)),
    //       }).catch((err) => console.error(`Failed to send to ${sub.email}`, err))
    //     )
    //   )
    //   sentCount += batch.length
    // }
        // 7. Send in batches
    const batchSize = 50
    let sentCount = 0

    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize)
      await Promise.all(
        batch.map((sub) =>
          sendEmail({
            to: sub.email,
            subject: `NBT Newsletter — ${new Date().toLocaleDateString()}`,
            html: html.replace(
              '{{unsubscribe_url}}',
              `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${createUnsubscribeToken(sub.email)}`
            ),
          }).catch((err) => console.error(`Failed to send to ${sub.email}`, err))
        )
      )
      sentCount += batch.length
    }

    await issuesCollection.updateOne({ _id: issueId }, { $set: { sentCount } })

    return NextResponse.json({ message: 'Newsletter sent', issueId: issueId.toHexString(), sentCount })
  } catch (err) {
    console.error('send-newsletter cron error', err)
    return NextResponse.json({ error: 'Failed to send newsletter' }, { status: 500 })
  }
}