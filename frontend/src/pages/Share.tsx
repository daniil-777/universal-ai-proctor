import { AppProvider } from "@/lib/store";
import { ChatDock } from "@/components/ChatDock";
import { BackendConnectionNotice } from "@/components/BackendConnectionNotice";
import { useParams } from "react-router-dom";

const Share = () => {
  const { sessionId } = useParams();
  return (
    <AppProvider>
      <div className="share-page bg-transparent p-2">
        <BackendConnectionNotice />
        <div className="text-[10px] text-muted-foreground mb-1 px-1">
          Session: {sessionId}
        </div>
        <div className="flex-1 min-h-0">
          <ChatDock embedded />
        </div>
      </div>
    </AppProvider>
  );
};

export default Share;
