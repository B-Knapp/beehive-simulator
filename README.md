# Beehive Simulator

**▶ Play it: https://b-knapp.github.io/beehive-simulator/**

An agent-based honey bee (*Apis mellifera*) colony simulation that runs in the browser. Open `index.html` — no build step or dependencies.

- Every bee and every comb cell (~140,000 in two Langstroth deeps) is simulated individually
- Brood development (worker 21 d, drone 24 d, queen 16 d), nurse feeding, chilled brood
- Age-based division of labour with social inhibition; workload-dependent lifespan (summer vs. winter bees)
- Foraging with waggle-dance recruitment oriented to the real sun azimuth, scouting, patch abandonment
- Nectar ripening and capping, pollen as bee bread, seasonal flora and weather (~45°N)
- Comb layout emerges from local rules (Camazine 1991; Montovan, Karst, Jones & Seeley 2013; Johnson 2009): the queen walks the comb and lays near brood, nectar is stored with a gravity bias, pollen beside the brood, stores next to brood are eaten first, nectar is moved out of the brood nest
- Queen laying, drone production, swarming (queen cups along the bottom of brood combs), virgin queens that hunt and kill rivals in their cells, queen duels, piping (tooting/quacking), afterswarms, mating flights, supersedure with mother–daughter coexistence, emergency queens, laying workers
- Swarm house-hunting (Seeley): scouts, dance support that fades with each trip, quorum sensing at candidate cavities, and the flight to the chosen site
- Beekeeper actions: add super, harvest, feed, introduce queen

`sim.js` is the standalone simulation engine (also runs headless in Node); `index.html` bundles it with the visual UI.
