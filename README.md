# Beehive Simulator

An agent-based honey bee (*Apis mellifera*) colony simulation that runs in the browser. Open `index.html` — no build step or dependencies.

- Every bee and every comb cell (~140,000 in two Langstroth deeps) is simulated individually
- Brood development (worker 21 d, drone 24 d, queen 16 d), nurse feeding, chilled brood
- Age-based division of labour with social inhibition; workload-dependent lifespan (summer vs. winter bees)
- Foraging with waggle-dance recruitment oriented to the real sun azimuth, scouting, patch abandonment
- Nectar ripening and capping, pollen as bee bread, seasonal flora and weather (~45°N)
- Queen laying, drone production, swarming, virgin queens and mating flights, supersedure, emergency queens, laying workers
- Beekeeper actions: add super, harvest, feed, introduce queen

`sim.js` is the standalone simulation engine (also runs headless in Node); `index.html` bundles it with the visual UI.
