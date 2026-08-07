import { Image, type ImageStyle, type StyleProp } from "react-native";

// The "turn" wordmark. Use variant="white" on dark backgrounds.
export function Brand({
  variant = "black",
  width = 92,
  style,
}: {
  variant?: "black" | "white";
  width?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={
        variant === "white"
          ? require("../../assets/images/turn-white.png")
          : require("../../assets/images/turn-black.png")
      }
      style={[{ width, height: width * 0.42 }, style]}
      resizeMode="contain"
    />
  );
}
