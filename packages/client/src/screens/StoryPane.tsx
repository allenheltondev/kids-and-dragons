/**
 * "Story" — the story so far, in the adventure book (#358).
 *
 * Each campaign the household has a story in, and in it each chapter it
 * played, in the order it played them: the chapter's goal, how it ended, what
 * it found out (its priority-1 scene, in the scene's own words), and the
 * "Last time…" lines for what it chose. Every line is authored and was read
 * against what the party held on the server (shared story-so-far.ts), so this
 * only draws `JournalResponse.story`, and works from the saved copy offline.
 *
 * Read-only, on the phone: it scrolls, and nothing in it can be changed.
 * Lazy: JournalScreen loads this chunk the first time "Story" is opened.
 */

import type { ReactElement } from "react";
import type { JournalResponse, JournalStoryCampaign, JournalStoryChapter } from "@kad/shared";
import { Icon } from "./icons";
import "./StoryPane.css";

const STANDING: Record<JournalStoryCampaign["status"], { icon: string; words: string }> = {
  active: { icon: "forward", words: "Still going" },
  complete: { icon: "crown", words: "The whole story" },
  failed: { icon: "charm", words: "This try is over" },
};

export default function StoryPane({ journal }: { journal: JournalResponse }): ReactElement {
  const story = journal.story ?? [];
  return (
    <div className="kad-surface kad-surface--player" data-surface="player">
      <section className="story kad-scroll" aria-label="The story so far">
        <h1 className="story__title">
          <Icon name="story" />
          <span>The story so far</span>
        </h1>
        {story.length === 0 ? (
          <p className="story__empty">
            {journal.story === undefined
              ? "Your story is not on this phone yet. Open the book again when you have a signal."
              : "No story yet. Play a chapter of an adventure, and it will be written here."}
          </p>
        ) : (
          story.map((campaign) => <Campaign key={campaign.campaignId} campaign={campaign} />)
        )}
      </section>
    </div>
  );
}

function Campaign({ campaign }: { campaign: JournalStoryCampaign }): ReactElement {
  const standing = STANDING[campaign.status];
  return (
    <article className="story__campaign" aria-labelledby={`story-${campaign.campaignId}`}>
      <header className="story__campaign-head">
        <h2 className="story__campaign-title" id={`story-${campaign.campaignId}`}>{campaign.title}</h2>
        <p className="story__standing">
          <Icon name={standing.icon} />
          <span>{standing.words}</span>
        </p>
      </header>
      <ol className="story__chapters">
        {campaign.chapters.map((chapter, i) => (
          <Chapter key={`${chapter.chapterId}:${String(i)}`} chapter={chapter} />
        ))}
      </ol>
    </article>
  );
}

function Chapter({ chapter }: { chapter: JournalStoryChapter }): ReactElement {
  const setback = chapter.outcome === "setback";
  return (
    <li className="story__chapter" data-outcome={chapter.outcome ?? "unknown"}>
      <h3 className="story__chapter-title">{chapter.title}</h3>
      {chapter.goal ? (
        <p className="story__goal">
          <Icon name="map" />
          <span><b>Your goal:</b> {chapter.goal}</span>
        </p>
      ) : null}
      {chapter.revealed.map((words, i) => (
        <blockquote className="story__revealed" key={i}>
          <p className="story__label">
            <Icon name="star" />
            <span>What you found out</span>
          </p>
          {words.split("\n\n").map((paragraph, j) => <p key={j}>{paragraph}</p>)}
        </blockquote>
      ))}
      {chapter.lastTime.length > 0 ? (
        <div className="story__chose">
          <p className="story__label">
            <Icon name="vote" />
            <span>What you chose</span>
          </p>
          <ul>
            {chapter.lastTime.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {chapter.ending ? (
        <p className="story__ending">
          {/* Icon and words carry the difference, never colour (spec §11). */}
          <Icon name={setback ? "scroll" : "trophy"} />
          <span>
            {setback ? <b>The story took a turn. </b> : <b>How it ended: </b>}
            {chapter.ending}
          </span>
        </p>
      ) : null}
    </li>
  );
}
