import bcrypt from "bcryptjs";
import { pool, db } from "../server/db";
import { users, communities, communityMembers } from "../shared/schema";
import { eq } from "drizzle-orm";

const PASSWORD = "Password123";

async function seed() {
  await pool.query(
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'property_manager'"
  );
  console.log("Ensured property_manager exists in user_role enum");

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  let [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.name, "Test Community"));

  if (!community) {
    [community] = await db
      .insert(communities)
      .values({ name: "Test Community", description: "Seeded test community" })
      .returning();
    console.log("Created Test Community:", community.id);
  } else {
    console.log("Test Community already exists:", community.id);
  }

  const seedUsers = [
    {
      username: "hoaadmin",
      displayName: "HOA Admin",
      role: "hoa_admin" as const,
      hoaCommunityId: community.id,
    },
    {
      username: "propertymanager",
      displayName: "Property Manager",
      role: "property_manager" as const,
      hoaCommunityId: null,
    },
    {
      username: "hoamember",
      displayName: "HOA Member",
      role: "hoa_member" as const,
      hoaCommunityId: community.id,
    },
  ];

  for (const u of seedUsers) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.username, u.username));

    if (existing) {
      await db
        .update(users)
        .set({
          password: hashedPassword,
          displayName: u.displayName,
          role: u.role,
          hoaCommunityId: u.hoaCommunityId,
        })
        .where(eq(users.id, existing.id));
      console.log(`Updated user: ${u.username} (${existing.id})`);

      if (u.hoaCommunityId) {
        await db
          .insert(communityMembers)
          .values({ communityId: u.hoaCommunityId, userId: existing.id })
          .onConflictDoNothing();
      }
    } else {
      const [created] = await db
        .insert(users)
        .values({
          username: u.username,
          password: hashedPassword,
          displayName: u.displayName,
          role: u.role,
          hoaCommunityId: u.hoaCommunityId,
        })
        .returning();
      console.log(`Created user: ${u.username} (${created.id})`);

      if (u.hoaCommunityId) {
        await db
          .insert(communityMembers)
          .values({ communityId: u.hoaCommunityId, userId: created.id })
          .onConflictDoNothing();
      }
    }
  }

  console.log("\nSeed complete. All test users have password: Password123");
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Seed failed:", err);
    pool.end();
    process.exit(1);
  });
