# Adding real photos

The site is built so real photos replace the placeholder artwork **just by adding files**. No code changes.
Until a file exists, the page shows a warm illustration (hero) or a coloured tile (life moments).

## Files and sizes
| File | Where it shows | Shape | Suggested size | Keep under |
|---|---|---|---|---|
| `assets/hero/hero.jpg` | big picture beside the headline | portrait 4:5 | 1200 x 1500 px | 300 KB |
| `assets/moments/family.jpg` | "Starting a family" | landscape 4:3 | 960 x 720 px | 120 KB |
| `assets/moments/school.jpg` | "Educating your children" | landscape 4:3 | 960 x 720 px | 120 KB |
| `assets/moments/car.jpg` | "Buying a car" | landscape 4:3 | 960 x 720 px | 120 KB |
| `assets/moments/business.jpg` | "Growing a business" | landscape 4:3 | 960 x 720 px | 120 KB |
| `assets/moments/retire.jpg` | "Planning for retirement" | landscape 4:3 | 960 x 720 px | 120 KB |
| `assets/moments/travel.jpg` | "Travelling abroad" | landscape 4:3 | 960 x 720 px | 120 KB |

Use exactly these names, in `.jpg`. Compress first (for example at squoosh.app) so the page loads fast on phones.

## What makes a good picture
Visitors decide in a few seconds, so show **people and calm, real life**, not paperwork.
- **Hero:** a Kenyan family (or parents with a child) at home or outdoors, close together, relaxed or laughing, natural daylight. Faces visible, subjects in the middle, some empty space at the top.
- **Starting a family:** parents with a baby or young child.
- **Educating your children:** a child in school uniform with a parent, or doing homework.
- **Buying a car:** a person next to their car, smiling (avoid crashes and clear number plates).
- **Growing a business:** a shop owner, mama mboga, salon or workshop team at work.
- **Retirement:** an older couple at ease, in a garden or on a veranda.
- **Travel:** a traveller at an airport or with a suitcase.
Avoid hospital beds, accidents, and anything frightening. The mood is peace of mind.

## Where to get them
1. **Best:** a local photographer for a half-day shoot. Real Kenyan faces and places feel more trustworthy than stock. Get a written release from everyone shown.
2. **Free libraries** (Unsplash, Pexels, Pixabay): check each photo's licence for commercial use, and avoid images with visible brand logos.
3. **Your own clients:** only with their written permission.

## Fine-tuning the crop
If a face is cut off, change the focus point on the hero picture in `index.html`:
`<figure class="hero-photo" id="heroPhoto" style="--hero-focus:50% 20%">` (first number = left/right, second = up/down, in percent).

## Publishing
Copy the files into these folders, then run `git add .`, `git commit -m "Add photos"` and `git push origin main`.
Pictures are cached for an hour, so a new photo may take a little while to appear for returning visitors.
