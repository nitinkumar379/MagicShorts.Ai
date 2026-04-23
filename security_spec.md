# Security Specification: ShortsMagic AI

## Data Invariants
1. A Video document must belong to a valid User ID.
2. Only the owner of a Video can read or delete it.
3. Only the system or the owner can update the status of a Video.
4. Users cannot create Videos for other users (userId must match request.auth.uid).
5. YouTube credentials must be strictly private (split collection or high restriction).

## The Dirty Dozen Payloads

### Video Collection
1. **Identity Spoofing**: Create a video with `userId` of another user.
2. **State Shortcutting**: Manually update status to `completed` without actual processing.
3. **Resource Poisoning**: Large string in `title` (e.g., 1MB of text).
4. **Invalid ID**: Injecting junk characters as `videoId`.
5. **Unauthorized Read**: Reading a video document that belongs to `user_B` as `user_A`.
6. **Unauthorized Delete**: Deleting a video document that belongs to `user_B` as `user_A`.
7. **Bypassing Verification**: Writing to `videos` with an unverified email (if restricted).
8. **Shadow Field**: Adding `isAdmin: true` to a video document.
9. **Timestamp Manipulation**: Setting `createdAt` to a future date.
10. **Orphaned Record**: Creating a video for a `userId` that doesn't exist in the `users` collection.
11. **Mass Extraction**: Authenticated user trying to `list` all videos in the collection without a filter.
12. **YouTube Account Leak**: Reading another user's `youtubeAccounts` subcollection.

## The Test Runner (firestore.rules.test.ts)

```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, collection, getDocs, query, where } from "firebase/firestore";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "remixed-project-id",
    firestore: {
      rules: require("fs").readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("ShortsMagic AI Security Rules", () => {
  const aliceAuth = { uid: "alice", email: "alice@example.com", email_verified: true };
  const bobAuth = { uid: "bob", email: "bob@example.com", email_verified: true };

  it("should prevent Alice from creating a video for Bob", async () => {
    const db = testEnv.authenticatedContext("alice", aliceAuth).firestore();
    await assertFails(setDoc(doc(db, "videos", "v1"), {
      userId: "bob",
      title: "Alice's attempt",
      status: "downloading"
    }));
  });

  it("should prevent Alice from reading Bob's videos", async () => {
     const dbAlice = testEnv.authenticatedContext("alice", aliceAuth).firestore();
     const dbSystem = testEnv.unauthenticatedContext().firestore(); // Mocking system write if needed, or use admin
     
     // Setup Bob's video (using admin or system equivalent)
     await testEnv.withSecurityRulesDisabled(async (context) => {
       await setDoc(doc(context.firestore(), "videos", "bob_v1"), {
         userId: "bob",
         title: "Bob's private video",
         status: "completed"
       });
     });

     await assertFails(getDoc(doc(dbAlice, "videos", "bob_v1")));
  });

  it("should prevent listing all videos without ownership filter", async () => {
    const db = testEnv.authenticatedContext("alice", aliceAuth).firestore();
    await assertFails(getDocs(collection(db, "videos")));
  });

  it("should allow listing own videos", async () => {
    const db = testEnv.authenticatedContext("alice", aliceAuth).firestore();
    const q = query(collection(db, "videos"), where("userId", "==", "alice"));
    await assertSucceeds(getDocs(q));
  });

  it("should prevent updating immutable fields like createdAt", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "videos", "v1"), {
        userId: "alice",
        title: "Test",
        status: "downloading",
        createdAt: new Date()
      });
    });

    const db = testEnv.authenticatedContext("alice", aliceAuth).firestore();
    await assertFails(setDoc(doc(db, "videos", "v1"), {
      createdAt: new Date(Date.now() + 100000)
    }, { merge: true }));
  });
});
```
