import { GalponLayout } from "./layout";
import { Construction } from "lucide-react";

export default function GalponStock() {
  return (
    <GalponLayout title="Stock">
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Construction className="h-10 w-10 opacity-50" />
        <p className="text-sm">Stock del galpón — en construcción.</p>
      </div>
    </GalponLayout>
  );
}
