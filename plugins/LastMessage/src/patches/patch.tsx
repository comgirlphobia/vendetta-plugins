import { find, findByProps, findByStoreName } from "@vendetta/metro";
import { React, FluxDispatcher } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { General } from "@vendetta/ui/components";

const { View } = General;

const RelationshipStore = findByStoreName("RelationshipStore");

const { TextStyleSheet, Text } = findByProps("TextStyleSheet");
const Timestamp = find((x) => x?.name === "Timestamp");

const { parseTimestamp } = findByProps("parseTimestamp");

function EventEmitter() {
    this.listeners = [];
    const event = this;

    this.addListener = function (fn) {
        event.listeners.push(fn);
        return () => event.removeListener(fn);
    };

    this.removeListener = function (fn) {
        event.listeners = event.listeners.filter((f) => f !== fn);
        return true;
    };

    this.fire = function (...args) {
        event.listeners.forEach((fn) => fn(...args));
        return true;
    };
}

const { addListener, removeListener, fire } = new EventEmitter();
let logs = {};
addListener((id, timestamp) => {
    let relations = Object.entries(RelationshipStore.getRelationships())
        .filter(([, type]) => type === 1)
        .map(([id]) => id);
    if (!(storage.everyone || relations.includes(id))) return;
    logs[id] = timestamp;
});

function useLastMessage(id) {
    const [lastMessage, setLastMessage] = React.useState(logs[id]);

    React.useEffect(() => {
        const onMessage = (author, timestamp) => {
            if (author !== id) return;
            setLastMessage(timestamp);
        };

        addListener(onMessage);

        return () => removeListener(onMessage);
    }, []);

    return lastMessage;
}

const listen = () => {
    function onMessage({ message }) {
        let id = message?.author?.id;
        let timestamp = message?.timestamp;
        if (id && timestamp) fire(id, Math.floor(new Date(timestamp).getTime() / 1000 - 1));
    }
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
    return () => FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
};

function LastMessageTime({ id }) {
    const timestamp = useLastMessage(id);
    if (!timestamp && !storage.showWhenNone) return <></>;
    return (
        <View style={{ marginTop: 10 }}>
            <Text style={[TextStyleSheet["text-xs/medium"]]}>
                Last message:{" "}
                {timestamp ? (
                    <Timestamp node={{ ...parseTimestamp(timestamp.toString(), "R"), type: "timestamp" }} />
                ) : (
                    "Unknown"
                )}
            </Text>
        </View>
    );
}


const patch = () => {
    // Updated finder for newer Discord versions (263+)
    const UserProfileSection = find((m) => 
        m?.default?.displayName?.includes?.("UserProfile") || 
        m?.default?.name?.includes?.("UserProfile") ||
        (m?.type?.displayName?.includes?.("Profile") && m?.type?.toString?.().includes("user"))
    );

    if (!UserProfileSection) {
        console.error("[LastMessage] Could not find UserProfile component");
        return () => {};
    }

    return after(
        "default", 
        UserProfileSection, 
        ([props], res) => {
            if (!res?.props?.children) return;

            // More robust injection - look for children array or common profile wrapper
            let children = res.props.children;
            if (typeof children === "function") children = children(props); // handle possible render prop

            if (Array.isArray(children)) {
                // Try to inject near the name / header area
                const nameIndex = children.findIndex(c => 
                    c?.props?.user || 
                    c?.type?.displayName?.includes?.("Name") ||
                    c?.props?.children?.[0]?.props?.user
                );
                
                if (nameIndex !== -1) {
                    children.splice(nameIndex + 1, 0, <LastMessageTime id={props.user?.id || props.userId} />);
                } else {
                    // Fallback: push to end of main container
                    if (Array.isArray(children[0]?.props?.children)) {
                        children[0].props.children.push(<LastMessageTime id={props.user?.id || props.userId} />);
                    } else {
                        children.push(<LastMessageTime id={props.user?.id || props.userId} />);
                    }
                }
            } else if (children?.props?.children) {
                // Nested children case
                const container = children.props.children;
                if (Array.isArray(container)) {
                    container.push(<LastMessageTime id={props.user?.id || props.userId} />);
                }
            }
        }
    );
};

export default function () {
    let patches = [listen(), patch()];
    return () => patches.forEach((unpatch) => unpatch?.());
}
