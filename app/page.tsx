import { PlanetaryDashboard } from "@/components/planetary/dashboard";
import { createDemoResponse } from "@/lib/planetary/demo";

export default function Home() {
  return <PlanetaryDashboard initialData={createDemoResponse()} />;
}
