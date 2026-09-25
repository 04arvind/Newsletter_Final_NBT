/**
 * Daily Poll API.
 *
 * GET  — today's poll question and options (mirrored from NBT) plus *our*
 *        readers' vote split, and this reader's own answer if they voted.
 * POST — records one reader's answer and returns the updated split.
 *
 * Every number in the response is ours. NBT supplies the wording only; its
 * site-wide tally is never fetched (see `fetch-nbt-poll.ts`).
 *
 * Readers are identified by an anonymous, httpOnly cookie minted here. It is a
 * random id with no link to a subscriber record — enough to keep one reader
 * from stuffing the tally, and to let them change their mind.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { NbtPoll } from '../../../lib/fetch-nbt-poll';
import { getActivePoll, type PollSource } from '../../../lib/poll-store';
import {
  getPollTally,
  getVoterChoice,
  isPollVotingEnabled,
  recordPollVote,
  toPercentages,
  type PollTally,
} from '../../../lib/poll-vote-store';

export const dynamic = 'force-dynamic';

const VOTER_COOKIE = 'nbt_poll_voter';
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface PollOptionPayload {
  label: string;
  /** 1-based option number, matching the order NBT lists them in. */
  value: number;
  /** Votes from our newsletter readers. */
  votes: number;
  /** Our readers' share, rounded to whole numbers that sum to 100. */
  percent: number;
}

export async function GET(request: NextRequest) {
  const { poll, stale, source, error } = await getActivePoll();

  if (!poll) {
    // Nothing live and nothing cached — let the client fall back to the
    // engine-generated hook rather than render an empty poll.
    const response = NextResponse.json(
      { error: 'No poll available', details: error },
      { status: 503 }
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  try {
    const voterId = request.cookies.get(VOTER_COOKIE)?.value || createVoterId();
    const votingEnabled = isPollVotingEnabled();

    const [tally, yourVote] = votingEnabled
      ? await Promise.all([
          getPollTally(poll.pollId),
          getVoterChoice(poll.pollId, voterId),
        ])
      : [emptyTally(), null];

    return pollResponse({
      poll,
      tally,
      yourVote,
      votingEnabled,
      stale,
      source,
      voterId,
    });
  } catch (err) {
    console.error('NBT poll API error:', err);
    // The poll itself resolved, so still render it — just without a tally.
    return pollResponse({
      poll,
      tally: emptyTally(),
      yourVote: null,
      votingEnabled: false,
      stale,
      source,
      voterId: request.cookies.get(VOTER_COOKIE)?.value || createVoterId(),
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isPollVotingEnabled()) {
      return NextResponse.json(
        { error: 'Poll voting is not configured (MONGODB_URI missing)' },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { pollId?: string; option?: number };
    if (!body.pollId || typeof body.option !== 'number') {
      return NextResponse.json({ error: 'Missing pollId or option' }, { status: 400 });
    }

    // Re-resolve rather than trusting the client: it pins the vote to a real
    // option on the poll that is actually live right now.
    const { poll, stale, source } = await getActivePoll();
    if (!poll) {
      return NextResponse.json({ error: 'No poll available' }, { status: 503 });
    }

    if (poll.pollId !== body.pollId) {
      return NextResponse.json(
        {
          error: 'Poll has changed',
          poll: toPayload(poll, emptyTally()),
        },
        { status: 409 }
      );
    }

    const label = poll.options[body.option];
    if (!label) {
      return NextResponse.json({ error: 'Unknown poll option' }, { status: 400 });
    }

    const voterId = request.cookies.get(VOTER_COOKIE)?.value || createVoterId();
    const tally = await recordPollVote({
      pollId: poll.pollId,
      option: body.option,
      optionValue: body.option + 1,
      optionLabel: label,
      voterId,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return pollResponse({
      poll,
      tally,
      yourVote: body.option,
      votingEnabled: true,
      stale,
      source,
      voterId,
    });
  } catch (error) {
    console.error('NBT poll vote error:', error);
    return NextResponse.json(
      { error: 'Failed to record vote', details: String(error) },
      { status: 500 }
    );
  }
}

function pollResponse(input: {
  poll: NbtPoll;
  tally: PollTally;
  yourVote: number | null;
  votingEnabled: boolean;
  stale: boolean;
  source: PollSource | null;
  voterId: string;
}): NextResponse {
  const response = NextResponse.json({
    poll: toPayload(input.poll, input.tally),
    totalVotes: input.tally.totalVotes,
    yourVote: input.yourVote,
    votingEnabled: input.votingEnabled,
    /** True when NBT was unreachable and this is the last poll we stored. */
    stale: input.stale,
    source: input.source,
  });

  // Per-reader and live-counting: must never sit in a shared cache. The NBT
  // read itself is still cached upstream inside fetchNbtPoll().
  response.headers.set('Cache-Control', 'no-store');
  setVoterCookie(response, input.voterId);
  return response;
}

function toPayload(poll: NbtPoll, tally: PollTally) {
  const counts = poll.options.map((_, index) => tally.counts[index] || 0);
  const percentages = toPercentages(counts, tally.totalVotes);

  const options: PollOptionPayload[] = poll.options.map((label, index) => ({
    label,
    value: index + 1,
    votes: counts[index],
    percent: percentages[index],
  }));

  return {
    pollId: poll.pollId,
    sectionId: poll.sectionId,
    question: poll.question,
    options,
    fetchedAt: poll.fetchedAt,
  };
}

function emptyTally(): PollTally {
  return { counts: {}, totalVotes: 0 };
}

function createVoterId(): string {
  return crypto.randomUUID();
}

function setVoterCookie(response: NextResponse, voterId: string): void {
  response.cookies.set(VOTER_COOKIE, voterId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VOTER_COOKIE_MAX_AGE,
  });
}
