# 100 Days Doing Something

A full-stack application built with React (Vite) and C# (.NET Core Web API) to track a 100-day habit or challenge.

## Features
- **Create Challenge:** Simple home screen to enter your challenge name and initialize a 100-day tracking grid.
- **Track Progress:** A visually rich grid of 100 checkboxes, beautifully styled using modern glassmorphism and vibrant gradients with Tailwind CSS.
- **Data Persistence:** Built-in SQLite database with Entity Framework Core to seamlessly save your progress.

## Milestone Animations Plan
As the challenge progresses, exciting animations will be added at key milestones to celebrate the journey!

- **Day 1:** Initial check-in animation (e.g., a burst of confetti or a glowing effect on the first checkbox).
- **Day 3:** "Creating Habit" animation.
- **Day 5:** Small milestone celebration.
- **Day 10:** Double-digit milestone unlock effect.
- **Day 20:** "On a Roll" dynamic background change.
- **Day 30:** 1-month celebration animation.
- **Day 50:** Halfway point grand animation!
- **Day 80:** "Almost There" sprint effect.
- **Day 100:** Ultimate completion fireworks and screen transformation.
- **Day 200:** (Bonus) Super habit unlocked!

## Getting Started

### Prerequisites
- Node.js (v18+) & pnpm
- .NET 9.0 SDK

### Run Backend
1. `cd backend`
2. `dotnet run` (Runs on http://localhost:5048)

### Run Frontend
1. `cd frontend`
2. `pnpm install`
3. `pnpm run dev`
