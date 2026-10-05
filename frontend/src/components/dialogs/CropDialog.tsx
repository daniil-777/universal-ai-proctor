import { useState } from "react";
import { Crop } from "lucide-react";
import { useApp } from "@/lib/store";
import { grabFrame } from "@/lib/frameBus";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CropDialog() {
  const a = useApp();
  const [preview, setPreview] = useState("");
  const [rect, setRect] = useState<[number, number, number, number]>([
    0, 0, 1, 1,
  ]);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setPreview(grabFrame().b64);
          setRect(a.analysis.cropRect || [0, 0, 1, 1]);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full gap-2">
          <Crop className="h-4 w-4" />
          {a.analysis.cropRect ? "Edit analysis region" : "Set analysis region"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Analysis region</DialogTitle>
          <DialogDescription>
            Focus visual analysis on a portion of the frame. Playback stays at
            full size.
          </DialogDescription>
        </DialogHeader>
        <div className="relative rounded-lg overflow-hidden bg-slate-950">
          {preview ? (
            <>
              <img
                src={`data:image/jpeg;base64,${preview}`}
                alt="Current frame for crop preview"
                className="w-full"
              />
              <div
                className="absolute border-2 border-teal-400 bg-teal-400/10"
                style={{
                  left: `${rect[0] * 100}%`,
                  top: `${rect[1] * 100}%`,
                  width: `${(rect[2] - rect[0]) * 100}%`,
                  height: `${(rect[3] - rect[1]) * 100}%`,
                }}
              />
            </>
          ) : (
            <p className="p-8 text-center text-sm text-slate-300">
              Load a video or camera for a preview.
            </p>
          )}
        </div>
        {["Left", "Top", "Right", "Bottom"].map((label, index) => (
          <div key={label} className="space-y-2">
            <label className="flex justify-between text-xs">
              {label}
              <span>{Math.round(rect[index] * 100)}%</span>
            </label>
            <Slider
              aria-label={`${label} crop boundary`}
              value={[rect[index] * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([value]) =>
                setRect((previous) => {
                  const next = [...previous] as typeof rect;
                  next[index] = value / 100;
                  return next;
                })
              }
            />
          </div>
        ))}
        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRect([0, 0, 1, 1]);
              a.setAnalysis({ cropRect: undefined });
            }}
          >
            Use full frame
          </Button>
          <Button
            disabled={rect[2] <= rect[0] || rect[3] <= rect[1]}
            onClick={() => {
              a.setAnalysis({ cropRect: rect });
              a.requestAnalysis();
            }}
          >
            Apply region
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
