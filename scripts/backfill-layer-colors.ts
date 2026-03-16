import { db } from "../server/db";
import { mapLayers } from "../shared/schema";
import { isNull, eq, and, asc } from "drizzle-orm";
import { getDefaultLayerColor } from "../shared/layerColors";

async function backfillLayerColors() {
  const layers = await db
    .select()
    .from(mapLayers)
    .where(isNull(mapLayers.color))
    .orderBy(asc(mapLayers.communityId), asc(mapLayers.layerKey), asc(mapLayers.createdAt), asc(mapLayers.id));

  if (layers.length === 0) {
    console.log("No layers need color backfill.");
    return;
  }

  const counters: Record<string, number> = {};

  for (const layer of layers) {
    const groupKey = `${layer.communityId}:${layer.layerKey}`;
    const count = counters[groupKey] || 0;
    const color = getDefaultLayerColor(layer.subLayerKey, count);
    counters[groupKey] = count + 1;

    await db
      .update(mapLayers)
      .set({ color })
      .where(eq(mapLayers.id, layer.id));

    console.log(`Updated ${layer.id} (${layer.subLayerKey}) -> ${color}`);
  }

  console.log(`Backfilled ${layers.length} layers.`);
}

backfillLayerColors()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
