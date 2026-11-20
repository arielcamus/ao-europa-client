// Adapted 2026-11-20 from Aurora.Network Writer.hpp / COM_Writer.cpp / Channel.cpp.
// Copyright (C) 2018-2022 by Agustin Alvarez. All rights reserved.
// This work is licensed under the terms of the Apache 2.0 license.
// See ../LICENSES/Apache-2.0.txt and ../NOTICE.
// Independent C++ golden-byte oracle. No TS encoder or game assets are used.
// Packet field sequences follow the paired VB6 procedures in docs/PROTOCOL.md.
// VB6 sequence adaptation: Copyright (C) 2023-2026 Noland Studios LTD,
// AGPL-3.0-or-later. Based on Argentum Online 0.11.6, Copyright (C) 2002
// Márquez Pablo Ignacio, and Baronsoft's VB6 Online RPG. WITHOUT ANY WARRANTY.
// See ../LICENSE. Aurora's algorithm retains the Apache notice above.
#include <bit>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

struct Writer {
    std::vector<uint8_t> bytes;
    void byte(uint8_t value) { bytes.push_back(value); }
    template<typename T> void fixed(T value) {
        // The target is VB6/x86: reproduce its native little endian writes explicitly.
        using U = std::make_unsigned_t<T>;
        U bits = static_cast<U>(value);
        for (size_t n = 0; n < sizeof(T); ++n) byte(bits >> (n * 8));
    }
    template<typename T> void varint(T value) {
        // Writer::WriteInt verbatim algorithm; signed negative input is NOT ZigZag.
        for (; value > 0x7F; value >>= 7u) {
            byte(static_cast<uint8_t>(value & 0x7Fu) | 0x80u);
        }
        byte(static_cast<uint8_t>(value) & 0x7Fu);
    }
    void i16(int16_t value) { fixed(value); }
    void i32(int32_t value) { fixed(value); }
    void real(float value) { fixed(std::bit_cast<uint32_t>(value)); }
    void string(const std::string& value) {
        varint(value.size());
        for (uint8_t byteValue : value) byte(byteValue);
    }
};

bool first = true;
void emit(const std::string& name, Writer value, bool frame = false) {
    if (frame) {
        Writer framed;
        framed.fixed(static_cast<uint16_t>(value.bytes.size()));
        framed.bytes.insert(framed.bytes.end(), value.bytes.begin(), value.bytes.end());
        value = framed;
    }
    std::ostringstream hex;
    for (auto byte : value.bytes) hex << std::hex << std::setw(2) << std::setfill('0') << unsigned(byte);
    std::cout << (first ? "" : ",\n") << "  \"" << name << "\": \"" << hex.str() << "\"";
    first = false;
}
Writer packet(int16_t id) { Writer value; value.i16(id); return value; }

int main() {
    std::cout << "{\n";
    for (int32_t value : {0, 1, 127, 128, 255, 16383, 16384, 2097151, 2097152,
                         268435455, 268435456, 2147483647, -1, -128, -129,
                         std::numeric_limits<int32_t>::min()}) {
        Writer w; w.varint<int32_t>(value); emit("int:" + std::to_string(value), w);
    }
    Writer primitive;
    primitive.byte(0); primitive.byte(1); primitive.byte(255);
    primitive.i16(-32768); primitive.i16(32767);
    primitive.i32(std::numeric_limits<int32_t>::min()); primitive.i32(2147483647);
    primitive.real(1.5f); primitive.string(""); primitive.string(std::string(1, '\0'));
    primitive.string("\xc3\xb1\xf0\x9f\x99\x82");
    emit("primitives", primitive);
    Writer bom; bom.string("\xef\xbb\xbf" "A"); emit("utf8BOM", bom);
    Writer array;
    array.varint<uint16_t>(2);
    array.varint<uint32_t>(uint32_t(-1)); array.varint<uint32_t>(2);
    array.varint<uint32_t>(7); array.varint<uint32_t>(3);
    for (int value : {9, 8, 7, 6, 5, 4}) array.byte(value);
    emit("safeArray", array);

    emit("Connected", packet(1), true);
    auto w = packet(1);
    w.varint<uint16_t>(1); w.varint<uint32_t>(1); w.varint<uint32_t>(10);
    for (int value = 1; value <= 10; ++value) w.byte(value);
    emit("ConnectedDebug", w, true);
    w = packet(305); w.string("a@b"); w.string("p\xc3\xb1"); emit("LoginAccount", w, true);
    w = packet(73); w.i32(300); w.string("A\xc3\xb1"); emit("LoginExistingChar", w, true);
    w = packet(78); w.byte(2); w.i32(0x01020304); emit("Walk", w, true);
    emit("RequestPositionUpdate", packet(79), true);
    w = packet(2); w.byte(0); emit("Logged", w, true);
    w = packet(7); w.byte(1); emit("Disconnect", w, true);
    w = packet(73); w.string("No \xc3\xb1"); emit("ErrorMsg", w, true);
    w = packet(30); w.i16(257); w.i16(258); emit("ChangeMap", w, true);
    w = packet(31); w.byte(200); w.byte(201); emit("PosUpdate", w, true);
    w = packet(47); w.i16(0x1234); emit("UserCharIndexInServer", w, true);
    w = packet(186); w.byte(200); w.byte(201); w.i16(0x1234); emit("PosUpdateUserChar", w, true);
    for (auto [name, id] : {std::pair{"CharacterMove", 44}, {"PosUpdateChar", 187}}) {
        w = packet(id); w.i16(0x1234); w.byte(200); w.byte(201); emit(name, w, true);
    }
    w = packet(158);
    for (int32_t value : {101,102,103,104,105,300,107,108,109,110,111,112,113,114,115,116}) w.i32(value);
    emit("Intervals", w, true);
    w = packet(199); w.varint<int32_t>(2);
    w.varint<int32_t>(300); w.string("A\xc3\xb1");
    for (int32_t value : {200,128,3,257,50,51,12,1,2,3,4,5}) w.varint<int32_t>(value);
    w.varint<int32_t>(2); w.string("B");
    for (int32_t value : {1,2,3,4,5,6,7,8,9,10,11,12}) w.varint<int32_t>(value);
    emit("AccountCharacterList", w, true);
    w = packet(42);
    w.i16(0x1234); w.i16(200); w.i16(201); w.byte(4); w.byte(50); w.byte(60);
    for (int16_t value : {202,203,204,205,206,207,-1}) w.i16(value);
    w.string("A\xc3\xb1"); w.byte(1); w.byte(128); w.byte(255);
    for (const auto& value : {"H","W","B","D","R","O","S"}) w.string(value);
    w.real(1.5f); w.byte(2); w.byte(1); w.i16(0x102); w.i16(0x304); w.byte(5);
    for (int32_t value : {1000,2000,3000,4000}) w.i32(value);
    for (int value : {6,3,7,8,9}) w.byte(value);
    w.i16(0x506); w.byte(10);
    emit("CharacterCreate", w, true);
    w = packet(75); w.string("Hola \xc3\xb1"); w.i32(3); emit("Talk", w, true);
    w = packet(25); w.i16(90); emit("UpdateSta", w, true);
    w = packet(26); w.i16(60); emit("UpdateMana", w, true);
    w = packet(27); w.i16(80); w.i32(123456); emit("UpdateHP", w, true);
    w = packet(28); w.i32(1200); w.i32(1000); emit("UpdateGold", w, true);
    w = packet(29); w.i32(25); emit("UpdateExp", w, true);
    w = packet(37); w.string("Hola \xc3\xb1"); w.byte(2); emit("ConsoleMsg", w, true);
    w.byte(3); emit("ConsoleMsgChannel", w, true);
    w = packet(61); w.i16(100); w.i16(80); w.i32(123456);
    for (int16_t value : {80,60,100,90}) w.i16(value);
    w.i32(1200); w.i32(1000); w.byte(12); w.i32(200); w.i32(25); w.byte(3);
    emit("UpdateUserStats", w, true);
    w = packet(63); w.byte(42); w.i16(2); w.i16(3); w.byte(1); w.real(1.5f);
    w.byte(1); w.i32(0x01020304); w.byte(0); emit("ChangeInventorySlot", w, true);
    w = packet(64); w.byte(3); emit("InventoryUnlockSlots", w, true);
    w = packet(66); w.byte(40); w.i16(0); w.i16(-1); w.byte(0); emit("ChangeSpellSlot", w, true);
    w = packet(78); for (int value : {100,75,100,85}) w.byte(value); emit("UpdateHungerAndThirst", w, true);
    std::cout << "\n}\n";
}
