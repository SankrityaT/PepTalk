# The 3 minute video

Rules, from the submission page: **3 minutes or less**, and anything past the
mark may not be reviewed. It has to cover four things: the problem, what you
built, a demo of it working, and how you used HydraDB and why it matters.

Aim to finish at **2:45**. Judges watching forty of these are not generous with
the last fifteen seconds.

## Before you hit record

1. Graph up, API up, `pnpm dev` up. All three, checked.
2. **Seed a conversation the day before, or at least an hour before.** The
   cross-session beat needs real history to reach for. Open the dashboard, ask
   "How is De Paul doing in the final third?", let it answer. That becomes the
   thread you recall later.
3. Answers take fifteen to twenty seconds, because the model runs through a CLI
   subprocess. **Cut those waits in the edit.** Do not sit there watching a
   spinner on camera.
4. 1440x900. Full screen, no bookmarks bar, notifications off.
5. Do a silent dry run of the click path first. The one thing that kills these
   is fumbling for a button while talking.

## Say it like you are talking to someone

Not a voiceover. No "in this video I will show you". No "let me walk you
through". Contractions, short sentences, and it is fine to sound slightly bored
by your own competence.

---

| Time | On screen | Say roughly this |
|---|---|---|
| **0:00** | Session, tape playing, boxes on | "So this is the World Cup final. Argentina, France. Pep has already watched it, and he found four passes worth stopping on." |
| **0:12** | Point at the thread | "That is not a summary. Every one of those is a ball where someone better was open, cut from the broadcast at the right second." |
| **0:22** | Hit Next, clip swaps, board draws | "Grey is what he played. Orange is what was on. Six times the threat, and no harder to complete." |
| **0:35** | Type: *How is De Paul doing in the final third?* | "And you can just ask it things." |
| **0:45** | Answer streams, chips appear | "Every number there is a node in the graph. Not a summary of one, the actual node it came out of." |
| **1:00** | **Flip MEMORY ON to off. Ask the same thing.** | "Now watch. Same model, same match, same question. Memory off." |
| **1:12** | It answers without norms | "It can still read the game in front of it. What it lost is everything it knew about him before today, and it says so instead of guessing." |
| **1:25** | Flip it back | "That is the whole product in one switch." |
| **1:35** | Thread picker, New conversation | "Different conversation. Nothing carries over in the browser." |
| **1:45** | Ask: *Remind me what we went over about De Paul* | |
| **1:55** | It recalls the earlier session | "It remembers Tuesday. And it never got sent the transcript. Twelve turns came back out of the graph, and the facts they cited are still hanging off them." |
| **2:10** | Open the earlier thread, chips visible | "That line is still pointing at the fact it was written from. The fact as it was then, not whatever replaced it since." |
| **2:20** | Your season, scroll the 22 | "Twenty two matches back to 1974. Same code on Barcelona is 531, and it found Guardiola's last season on its own, out of possession numbers and dates." |
| **2:35** | Schema, or just talk over the season list | "That is what HydraDB is doing. Every fact has a start date, an end date, and an edge to whatever replaced it. A vector store cannot hold that, so it averages the eras and describes a team that never existed." |
| **2:45** | Stop | |

## If you are running long

Cut **0:22** and **2:20**. Do not cut 1:00 or 1:45. Those two are the
submission: the memory switch and the cross-session recall. Everything else is
context for them.

## Do not say

- "leverages", "seamlessly", "powered by", "cutting edge"
- Any number you have not checked this week
- "AI" as a noun on its own
- Anything about LongMemEval. It is not in the pitch.
