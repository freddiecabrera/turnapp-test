import { Image } from "react-native";

export function TurnCoin({ size = 22 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/images/turn-coin.png")}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
