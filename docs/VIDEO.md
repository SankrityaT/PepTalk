# The 3 minute video

**3 minutes or less.** Anything past the mark may not be reviewed, so aim to
finish at **2:50**. Judges watching forty of these are not generous with the
last fifteen seconds.

Four things have to appear: the problem, what you built, a demo of it working,
and **how you used HydraDB and why it matters**. That last one is a scored
requirement, not a formality, so it gets its own thirty seconds rather than a
sentence at the end.

## Two people, one video

Sanki records the main run. Kinjal records the upload segment on his machine.
Cut Kinjal's in at **2:05**, keep it to **25 seconds**, and hand back for the
close. If his segment runs long, cut the tape walkthrough at 0:25 rather than
anything after 0:50.

## Before you record

1. Graph up, API up, `pnpm dev` up.
2. **Seed a conversation an hour before.** Ask "How is De Paul doing in the
   final third?" and let it answer. That is the thread you recall at 1:20;
   without it that beat has nothing to reach for.
3. Answers take fifteen to twenty seconds through the CLI. **Cut those waits in
   the edit.** Nobody should watch a spinner.
4. 1440x900, full screen, no bookmarks bar, notifications off.
5. Dry run the clicks once in silence. Fumbling for a button while talking is
   what kills these.

## Talk like a person

No "in this video I will show you". No "leverages", "seamlessly", "powered by".
Contractions. Short sentences. You are showing a mate something you built.

---

| Time | On screen | Say roughly this |
|---|---|---|
| **0:00** | Session, tape playing, boxes on | "This is the World Cup final. Pep already watched it and found four passes worth stopping on." |
| **0:12** | Next, clip swaps, board draws | "Grey is what he played. Orange is what was on. Six times the threat, and no harder to complete." |
| **0:25** | Type: *How is De Paul doing in the final third?* | "And you can just ask it." |
| **0:35** | Answer streams, chips appear | "Every number in that answer is a row in the database. Those chips are the actual node ids it read." |
| **0:50** | **Flip MEMORY ON to off. Same question.** | "Now watch. Same model, same match, same question. Memory off." |
| **1:02** | It answers without norms | "It can still read the game in front of it. What it lost is everything it knew about him before today. And it says so instead of guessing, which is the part most systems get wrong." |
| **1:15** | Flip back. Thread picker, New conversation | "Different conversation. Nothing carries over in the browser." |
| **1:22** | Ask: *Remind me what we went over about De Paul* | |
| **1:32** | It recalls the earlier session | "It remembers Tuesday. And it never got sent the transcript. Twelve turns came back out of the graph and the facts they cited are still hanging off them." |
| **1:45** | **Click "What Pep knows". The graph.** | "This is the database. Not a diagram of it, the actual thing." |
| **1:52** | Graph turning, memories surfacing | "Every mark is a row. Teams, matches, players, and the diamonds are dated facts. Orange means still true." |
| **2:00** | Point at an orange curve | "Those orange lines are the one thing that makes this work. Every fact has a start date, an end date, and an edge to whatever replaced it. That is a supersession chain, and it is why asking about 2011 and asking about 2021 give you two different answers, both correct. A vector store has nowhere to put that, so it averages the two and describes a team that never existed." |
| **2:20** | *Kinjal's segment, 25s* | Upload a game, watch it run, land on the new fixture. |
| **2:45** | Back to the graph, or the season list | "Fifty three sides, four thousand matches, all of it dated. Point it at your team by editing one file." |
| **2:50** | Stop | |

## The HydraDB part, if you want it tighter

If 2:00 feels long, this is the compressed version and it still satisfies the
requirement:

> "Everything is stored in HydraDB as a graph. Facts hang off teams and
> players, each one carrying the dates it was true, with an edge pointing at
> whatever replaced it. Answers cite the node they came from, and the
> conversation lives in the same graph on the same clock. Turn it off and you
> get the second answer you just saw."

Name these out loud at least once, because they are what "which parts" means:

- **the node kinds** Team, Match, Player, Fact, Session, Turn
- **the edge that matters** `SUPERSEDED_BY`
- **the query** "what was true on this date"
- **the switch** the same lookup without dates, which is what a vector index
  would have returned

## Do not

- Cut 0:50 or 1:22. Those two beats are the submission.
- Mention LongMemEval. It is not in the pitch.
- Quote a number you have not checked this week.
- Say "AI" as a noun on its own.
