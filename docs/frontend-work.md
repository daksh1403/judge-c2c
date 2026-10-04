# Frontend Polish Work

This document tracks the frontend enhancement work to make Judge-C2C's sophisticated judging capabilities visible in the UI.

## Goal

The frontend should showcase all backend capabilities so judges can evaluate submissions without needing to inspect JSON, logs, databases, or source files.

## Current State

The frontend is functional but resembles the earlier system. It needs to be updated to reflect the substantial backend improvements including:
- Bounded evidence-backed analysis for 24 semantic review facets
- Engineering review dimensions
- Additional contributions system
- Attention items
- Artifact storage
- Baseline comparison
- AI review grounding

## Planned Improvements

### 1. Submission Detail Page Redesign
- Progressive disclosure with clear sections
- Judge summary card with key findings
- Dedicated objective checks section with baseline comparison
- Code quality section with bounded analysis results
- Security section with scanner findings
- Architecture section with bounded analysis
- Improved additional contributions display
- Evidence explorer section

### 2. Overview Page Enhancement
- Better metrics display
- Recent activity feed
- Queue status
- System health indicators

### 3. Submission List Improvements
- Better filters (team, issue, status, security concerns)
- Sorting options (newest, oldest, severity)
- Needs attention indicator

### 4. Needs Attention Page
- Work queue for items requiring human review
- Clear indication of what happened and why review is needed
- Action items for judges

### 5. AI Review State Visualization
- Clear distinction between objective checks and AI review
- Grounding state display
- Unsupported claims rejected
- Assessment verification status

## Dependencies

This PR depends on PR #6 (feat/evaluation-completeness) which implements the bounded analysis and backend capabilities.
