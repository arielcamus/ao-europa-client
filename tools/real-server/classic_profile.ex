# AGPL-3.0-or-later. Classic wire compatibility for lambdaclass/argentum.
# This module translates transport/authentication only. Gameplay belongs to Arena.
defmodule AoTcpGateway.ClassicProfile do
  import Bitwise
  alias AoProtocol.Server.Encoder
  alias GameBackend.{Account, Characters}

  def enabled?, do: System.get_env("AO_PROTOCOL_PROFILE") == "classic"

  def decode(data) do
    if enabled?(), do: decode_frame(data), else: AoProtocol.Client.Decoder.decode(data)
  end

  def decode_frame(data) when byte_size(data) < 2, do: :incomplete
  def decode_frame(<<length::little-unsigned-16, rest::binary>>) do
    cond do
      length < 2 or length > 4096 -> {:error, :invalid_classic_frame_length}
      byte_size(rest) < length -> :incomplete
      true ->
        <<body::binary-size(length), remaining::binary>> = rest
        try do
          {:ok, decode_body(body), remaining}
        rescue
          _ in [MatchError, ArgumentError, FunctionClauseError] -> {:error, :malformed_classic_packet}
        catch
          :invalid -> {:error, :malformed_classic_packet}
        end
    end
  end

  defp decode_body(<<305::little-signed-16, fields::binary>>) do
    {username, fields} = read_string(fields)
    {password, <<>>} = read_string(fields)
    {:classic_login_account, %{username: username, password: password}}
  end
  defp decode_body(<<73::little-signed-16, id::little-signed-32, fields::binary>>) do
    {name, <<>>} = read_string(fields)
    {:classic_login_character, %{id: id, name: name}}
  end
  defp decode_body(<<78::little-signed-16, heading, counter::little-signed-32>>)
       when heading in 1..4 and counter > 0 do
    {:walk, %{direction: Enum.at([:north, :east, :south, :west], heading - 1), packet_count: counter}}
  end
  defp decode_body(<<79::little-signed-16>>), do: {:request_position_update, %{}}

  def login_account(%{account_id: nil, character_id: nil} = state, params) do
    account = Account.get_by_username(params.username)
    if Account.verify_password(account, params.password) and not Account.banned?(account) do
      {%{state | account_id: account.id},
       [{:classic_character_list, Characters.list_for_account(account.id)}]}
    else
      {state, [{:error_msg, %{message: "Invalid account credentials."}}]}
    end
  end
  def login_account(state, _params), do: {state, [{:error_msg, %{message: "Already authenticated."}}]}

  def login_character(%{account_id: account_id, character_id: nil} = state, params)
      when not is_nil(account_id) do
    case Characters.get_for_account(account_id, params.id) do
      %{name: name, session_token: token} when name == params.name ->
        # Reuse the normal token-checked login, including bans, duplicate sessions,
        # authoritative map entry, inventory loading and persistence.
        AoTcpGateway.SessionLogic.login_existing(state, params.id, token)
      _ -> {state, [{:error_msg, %{message: "Character does not belong to this account."}}]}
    end
  end
  def login_character(state, _params), do: {state, [{:error_msg, %{message: "Authenticate first."}}]}

  def encode({:classic_character_list, characters}) do
    records = Enum.map(characters, fn c ->
      class = Enum.find_index(~w(mage cleric paladin hunter worker warrior thief bandit assassin druid bard pirate), &(&1 == c.class))
      values = [c.body_id, c.head_id, if(class, do: class + 1, else: 0), c.map_id,
                c.pos_x, c.pos_y, c.level, if(c.criminal, do: 2, else: 1), 0, 0, 0, 0]
      [varint(c.id), string(c.name), Enum.map(values, &varint/1)]
    end)
    IO.iodata_to_binary([<<199::little-signed-16>>, varint(length(characters)), records])
  end
  def encode(command), do: Encoder.encode(command)

  # Called at the TCP boundary for each individual egress packet, after its
  # existing priority/coalescing classification. The shared server codec stays
  # untouched, including its WebSocket clients and gameplay broadcasts.
  def wire(packet) do
    if enabled?() do
      body = normalize(packet)
      if byte_size(body) > 65535, do: raise(ArgumentError, "classic frame too large")
      <<byte_size(body)::little-unsigned-16, body::binary>>
    else
      packet
    end
  end

  defp normalize(<<42::little-signed-16, fixed::binary-size(23), rest::binary>>) do
    {name, <<flags::binary-size(3), rest::binary>>} = old_string(rest)
    {auras, tail} = Enum.map_reduce(1..7, rest, fn _, bytes ->
      {value, bytes} = old_string(bytes)
      {string(value), bytes}
    end)
    <<numeric::binary-size(34)>> = tail
    # This port has no clan alignment field. Zero is the neutral alignment.
    IO.iodata_to_binary([<<42::little-signed-16>>, fixed, string(name), flags, auras, numeric, <<0>>])
  end
  defp normalize(<<73::little-signed-16, rest::binary>>) do
    {message, <<>>} = old_string(rest)
    <<73::little-signed-16, string(message)::binary>>
  end
  defp normalize(<<158::little-signed-16, rest::binary>>) do
    [bow, walk, hit, hit_magic, magic, magic_hit, hit_use, extract, build, use_key, use_click, drop] =
      for <<value::little-signed-32 <- rest>>, do: value
    values = [hit, bow, magic, extract, build, walk, drop, use_key, use_click,
              hit_magic, magic_hit, hit_use, 0, 0, 0, 0]
    IO.iodata_to_binary([<<158::little-signed-16>>, Enum.map(values, &<<&1::little-signed-32>>)])
  end
  defp normalize(<<7::little-signed-16>>), do: <<7::little-signed-16, 1>>
  defp normalize(<<30::little-signed-16, map::little-signed-16, 0::little-signed-16>>) do
    # The port calls this field version and always sends zero; its resource
    # filename is mapa<map>.csm, so classic MapResource is the actual map ID.
    <<30::little-signed-16, map::little-signed-16, map::little-signed-16>>
  end
  defp normalize(packet), do: packet

  def varint(value) when value >= 0 and value < 128, do: <<value>>
  def varint(value) when value >= 128 and value <= 2_147_483_647,
    do: <<bor(band(value, 127), 128), varint(value >>> 7)::binary>>
  def string(value), do: <<varint(byte_size(value))::binary, value::binary>>

  defp read_string(data) do
    {size, rest} = read_varint(data, 0, 0)
    if size > 1024, do: throw(:invalid)
    <<value::binary-size(size), rest::binary>> = rest
    if not String.valid?(value), do: throw(:invalid)
    {value, rest}
  end
  defp read_varint(<<byte, rest::binary>>, shift, value) when shift <= 28 do
    if shift == 28 and byte > 7, do: throw(:invalid)
    value = bor(value, band(byte, 127) <<< shift)
    if byte < 128, do: {value, rest}, else: read_varint(rest, shift + 7, value)
  end
  defp old_string(<<size::little-signed-16, rest::binary>>) when size >= 0 do
    <<value::binary-size(size), rest::binary>> = rest
    {value, rest}
  end
end
