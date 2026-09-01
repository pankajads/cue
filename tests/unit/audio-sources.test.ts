import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSystemAudioSourceId, AudioSourceDeps } from "../../src/main/audio-sources";

function fakeDeps(overrides: Partial<AudioSourceDeps>): AudioSourceDeps {
  return {
    platform: "darwin",
    getMediaAccessStatus: () => {
      throw new Error("getMediaAccessStatus should not be called by this test");
    },
    getSources: async () => {
      throw new Error("getSources should not be called by this test");
    },
    ...overrides,
  };
}

test("darwin: returns null without querying desktopCapturer when screen recording is not granted", async () => {
  const id = await resolveSystemAudioSourceId(
    fakeDeps({
      platform: "darwin",
      getMediaAccessStatus: () => "denied",
    })
  );
  assert.equal(id, null);
});

test("darwin: returns the first source id once permission is granted and sources exist", async () => {
  const id = await resolveSystemAudioSourceId(
    fakeDeps({
      platform: "darwin",
      getMediaAccessStatus: () => "granted",
      getSources: async () => [{ id: "screen:0:0" }, { id: "screen:1:0" }],
    })
  );
  assert.equal(id, "screen:0:0");
});

test("returns null (not throw) when permission is granted but no capturable source exists", async () => {
  const id = await resolveSystemAudioSourceId(
    fakeDeps({
      platform: "darwin",
      getMediaAccessStatus: () => "granted",
      getSources: async () => [],
    })
  );
  assert.equal(id, null);
});

test("non-macOS platforms skip the TCC permission check entirely", async () => {
  let getSourcesCalled = false;
  const id = await resolveSystemAudioSourceId({
    platform: "win32",
    getMediaAccessStatus: () => {
      throw new Error("getMediaAccessStatus should not be called on non-macOS");
    },
    getSources: async () => {
      getSourcesCalled = true;
      return [{ id: "screen:0:0" }];
    },
  });
  assert.equal(getSourcesCalled, true);
  assert.equal(id, "screen:0:0");
});
