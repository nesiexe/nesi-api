import { getBarqUserCount } from "../repositories/contact";

interface BarqUserCountResponse {
    userCount: number | null;
}

export async function getBarqUsers(): Promise<BarqUserCountResponse> {
    const data = await getBarqUserCount()

    return data;
}