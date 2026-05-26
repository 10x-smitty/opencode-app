---
name: ask-artie-data
description: Use when interpreting pasted, uploaded, demo, or user-described artist metrics without inventing unavailable connector data.
compatibility: opencode
---

## What To Do

Reason from only the data available in the chat and injected context. Treat injected Chartmetric context as the primary source of truth, then use pasted tables, summaries, CSV excerpts, JSON snippets, campaign notes, and user descriptions as supporting context.

## Data Handling Rules

- Separate facts from assumptions.
- Do not invent missing metrics, connector results, demographics, city rankings, revenue, or audience segments.
- If Chartmetric context is unavailable or an endpoint failed, say which data is missing before making a recommendation.
- If the user asks for analysis but no data is present, ask for the minimum useful data or provide a template for what to paste.
- If the data is partial, explain the confidence level and the missing data that would change the recommendation.
- When possible, convert raw metrics into useful decisions: where to focus, what to test, which fan segment matters, which city deserves attention, or what content should be repeated.

## Useful Analysis Patterns

- Identify spikes, drops, outliers, and repeated patterns.
- Compare engagement quality against raw reach.
- Separate audience growth from audience conversion.
- Prioritize cities or platforms by momentum, not just size.
- Recommend one next experiment and one follow-up metric.
