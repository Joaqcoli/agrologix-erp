import { GalponLayout } from "./layout";
import { Construction } from "lucide-react";

export default function GalponAjustes() {
  return (
    <GalponLayout title="Ajustes de stock">
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Construction className="h-10 w-10 opacity-50" />
        <p className="text-sm">Ajustes de stock del galpón — en construcción.</p>
      </div>
    </GalponLayout>
  );
}
