import { fetchCurrentlyPlaying } from "../repositories/spotify-repo";

export async function getCurrentlyPlaying() {
  return fetchCurrentlyPlaying();
}
